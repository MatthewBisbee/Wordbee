import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearStoredAdditionalGameValue,
  getAdditionalGameStorageKey,
  loadStatsForGameUser,
  loadStoredAdditionalGameValue,
  notifyDateClamp,
  saveStoredAdditionalGameValue,
  type SessionRequest,
} from '../games/game-utils'
import { requestJson } from '../../lib/api'
import type {
  AccessState,
  MultigameCompletionResult,
  MultigameCompleteHandler,
  SpellingBeeGuessResponse,
  SpellingBeeProgress,
  SpellingBeePuzzle,
} from '../../types'

// The seven letters clip into a honeycomb via these positions — the exact
// offsets NYT uses (cell 0 is the center; 1–6 wrap clockwise from upper-left).
const CELL_POSITIONS = [
  { left: '30%', top: '33.3333%' }, // 0: Center
  { left: '0%', top: '16.6667%' },  // 1: Upper-left
  { left: '30%', top: '0%' },       // 2: Top
  { left: '60%', top: '16.6667%' },  // 3: Upper-right
  { left: '60%', top: '50%' },      // 4: Lower-right
  { left: '30%', top: '66.6667%' }, // 5: Bottom
  { left: '0%', top: '50%' },       // 6: Lower-left
]
// Flat-top hexagon matching NYT's clip-path polygon(0% 50%, 25% 0% ...).
const HEX_POINTS = '0,43.3 25,0 75,0 100,43.3 75,86.6 25,86.6'

const REASON_MESSAGES: Record<string, string> = {
  'too-short': 'Too short',
  'missing-center': 'Missing center letter',
  'bad-letters': 'Bad letters',
  'not-a-word': 'Not in word list',
}

// NYT-style praise, escalating with the points earned.
const PRAISE = ['Good!', 'Nice!', 'Awesome!', 'Great!', 'Amazing!']

function isPangramWord(word: string) {
  return new Set(word).size === 7
}

function scoreWord(word: string) {
  if (word.length < 5) return 1
  return word.length + (isPangramWord(word) ? 7 : 0)
}

function scoreWords(words: string[]) {
  return words.reduce((total, word) => total + scoreWord(word), 0)
}

function rankIndexForScore(score: number, ranks: { minScore: number }[]) {
  let index = 0
  ranks.forEach((rank, rankIndex) => {
    if (score >= rank.minScore) index = rankIndex
  })
  return index
}

type SpellingBeeAttemptState = { words: string[] }

export function SpellingBeeGame({
  accessState,
  clientSessionId,
  isInputBlocked,
  requestedDate,
  requestWithSessionRecovery,
  showToast,
  onGameComplete,
  onGameLoadedAndComplete,
  onGameReset,
  onResolvedDate,
}: {
  accessState: AccessState | null
  clientSessionId: string
  isInputBlocked: boolean
  requestedDate: string
  requestWithSessionRecovery: SessionRequest
  showToast: (message: string, durationMs?: number) => void
  onGameComplete: MultigameCompleteHandler
  onGameLoadedAndComplete: MultigameCompleteHandler
  onGameReset: () => void
  onResolvedDate: (date: string) => void
}) {
  const [puzzle, setPuzzle] = useState<SpellingBeePuzzle | null>(null)
  const [puzzleError, setPuzzleError] = useState('')
  const [foundWords, setFoundWords] = useState<string[]>([])
  const [currentWord, setCurrentWord] = useState('')
  const [outerOrder, setOuterOrder] = useState<number[]>([0, 1, 2, 3, 4, 5])
  const [shake, setShake] = useState(false)
  const [pop, setPop] = useState(false)
  const [isShuffling, setIsShuffling] = useState(false)

  const foundWordsRef = useRef<string[]>([])
  const puzzleDateRef = useRef('')
  const syncTimerRef = useRef<number | null>(null)
  const geniusAnnouncedRef = useRef(false)

  const isSignedIn = accessState?.kind === 'friends-family'
  const canPlay = Boolean(puzzle) && !isInputBlocked

  const centerLetter = puzzle?.centerLetter ?? ''
  const validLetters = useMemo(() => new Set(puzzle?.validLetters ?? []), [puzzle])
  const foundSet = useMemo(() => new Set(foundWords), [foundWords])

  const score = useMemo(() => scoreWords(foundWords), [foundWords])
  const rankIndex = puzzle ? rankIndexForScore(score, puzzle.ranks) : 0
  const rankTitle = puzzle ? puzzle.ranks[rankIndex]?.title ?? 'Beginner' : 'Beginner'
  const isQueenBee = Boolean(puzzle) && foundWords.length === puzzle?.totalWords && foundWords.length > 0


  useEffect(() => {
    foundWordsRef.current = foundWords
  }, [foundWords])

  const buildAggregate = useCallback(
    (words: string[]): SpellingBeeProgress => {
      const wordScore = scoreWords(words)
      const ranks = puzzle?.ranks ?? []
      const nextRankIndex = rankIndexForScore(wordScore, ranks)
      const maxScore = puzzle?.maxScore ?? 0
      return {
        words,
        wordCount: words.length,
        score: wordScore,
        maxScore,
        rank: ranks[nextRankIndex]?.title ?? 'Beginner',
        rankIndex: nextRankIndex,
        totalWords: puzzle?.totalWords ?? 0,
        pangramsFound: words.filter(isPangramWord).length,
        totalPangrams: puzzle?.totalPangrams ?? 0,
        isQueenBee: words.length === puzzle?.totalWords && words.length > 0,
        percent: maxScore ? Math.round((wordScore / maxScore) * 100) : 0,
        reachedGenius: nextRankIndex >= (ranks.length ? ranks.length - 2 : 8),
      }
    },
    [puzzle],
  )

  const completionResult = useCallback(
    (words: string[]): MultigameCompletionResult => ({
      date: puzzle?.date ?? requestedDate,
      elapsedSeconds: null,
      outcome: 'won',
      variant: 'daily',
      score: buildAggregate(words) as unknown as Record<string, unknown>,
    }),
    [buildAggregate, puzzle, requestedDate],
  )

  // These take the puzzle date explicitly (never read `puzzle` state) so their
  // identity stays stable and they can sit in loadPuzzle's deps without churning
  // its identity and triggering a reload loop (the Letter Boxed gotcha).
  const persistLocal = useCallback((puzzleDate: string, words: string[]) => {
    const resultKey = getAdditionalGameStorageKey({
      date: puzzleDate,
      gameKey: 'spellingbee',
      kind: 'result',
      variant: 'daily',
    })
    if (words.length > 0) {
      saveStoredAdditionalGameValue(resultKey, { words } satisfies SpellingBeeAttemptState)
    } else {
      clearStoredAdditionalGameValue(resultKey)
    }
  }, [])

  // Push the local found set to the server, which unions it with anything stored
  // for this user (this or another device) and returns the authoritative merged
  // set. Adopting that keeps every device converged. Signed-in only.
  const syncProgress = useCallback(
    async (puzzleDate: string, words: string[]) => {
      if (!isSignedIn) return
      try {
        const merged = await requestWithSessionRecovery<SpellingBeeProgress>(
          '/api/games/spellingbee/progress',
          () => ({
            body: JSON.stringify({
              clientSessionId,
              date: puzzleDate,
              friendsFamilyToken:
                accessState?.kind === 'friends-family' ? accessState.token : '',
              words,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          }),
        )
        if (Array.isArray(merged.words)) {
          setFoundWords((previous) => {
            const union = Array.from(new Set([...previous, ...merged.words]))
            if (union.length === previous.length) return previous
            persistLocal(puzzleDate, union)
            return union
          })
        }
      } catch (error) {
        console.warn('Could not sync Spelling Bee progress', error)
      }
    },
    [accessState, clientSessionId, isSignedIn, persistLocal, requestWithSessionRecovery],
  )

  const scheduleSync = useCallback(
    (puzzleDate: string, words: string[]) => {
      if (!isSignedIn) return
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current)
      syncTimerRef.current = window.setTimeout(() => {
        syncTimerRef.current = null
        void syncProgress(puzzleDate, words)
      }, 700)
    },
    [isSignedIn, syncProgress],
  )

  const loadPuzzle = useCallback(async () => {
    onGameReset()
    setPuzzleError('')
    setFoundWords([])
    setCurrentWord('')
    geniusAnnouncedRef.current = false

    try {
      const activePuzzle = await requestJson<SpellingBeePuzzle>(
        `/api/games/spellingbee/today?date=${encodeURIComponent(requestedDate)}`,
        { cache: 'no-store' },
      )
      setPuzzle(activePuzzle)
      puzzleDateRef.current = activePuzzle.date
      setOuterOrder([0, 1, 2, 3, 4, 5])
      notifyDateClamp(activePuzzle, 'spellingbee', showToast)
      onResolvedDate(activePuzzle.date)

      const localResult = loadStoredAdditionalGameValue<SpellingBeeAttemptState>(
        getAdditionalGameStorageKey({
          date: activePuzzle.date,
          gameKey: 'spellingbee',
          kind: 'result',
          variant: 'daily',
        }),
      )
      const localWords = Array.isArray(localResult?.words) ? localResult.words : []

      if (isSignedIn) {
        // Merge whatever this device knows with the server's stored set (which may
        // include words found on another device), then adopt the union.
        await syncProgress(activePuzzle.date, localWords)
      } else if (localWords.length > 0) {
        setFoundWords(localWords)
      }
    } catch (error) {
      setPuzzleError(error instanceof Error ? error.message : 'Could not load Spelling Bee')
    }
  }, [isSignedIn, onGameReset, onResolvedDate, requestedDate, showToast, syncProgress])

  useEffect(() => {
    void loadPuzzle()
  }, [loadPuzzle])

  // Keep the header "See results" hook and celebrate crossing into Genius. Runs
  // whenever the found set changes.
  useEffect(() => {
    if (!puzzle || foundWords.length === 0) return
    onGameLoadedAndComplete(completionResult(foundWords), null)

    const geniusIndex = puzzle.ranks.length - 2
    if (rankIndex >= geniusIndex && !geniusAnnouncedRef.current) {
      geniusAnnouncedRef.current = true
      const celebrate = async () => {
        const stats = isSignedIn
          ? await loadStatsForGameUser({
              accessState,
              clientSessionId,
              gameKey: 'spellingbee',
              requestWithSessionRecovery,
            })
          : null
        onGameComplete(completionResult(foundWordsRef.current), stats)
      }
      showToast(isQueenBee ? '👑 Queen Bee!' : '🌟 Genius!', 2600)
      void celebrate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foundWords, rankIndex])

  // Pull any cross-device updates when the tab regains focus.
  useEffect(() => {
    if (!isSignedIn) return
    const onFocus = () => {
      if (puzzleDateRef.current) void syncProgress(puzzleDateRef.current, foundWordsRef.current)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [isSignedIn, syncProgress])

  useEffect(
    () => () => {
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current)
    },
    [],
  )

  const flashShake = useCallback((message: string) => {
    setShake(true)
    window.setTimeout(() => setShake(false), 400)
    return message
  }, [])

  const addLetter = useCallback(
    (letter: string) => {
      if (!canPlay || !validLetters.has(letter)) return
      setCurrentWord((previous) => previous + letter)
    },
    [canPlay, validLetters],
  )

  const deleteLetter = useCallback(() => {
    if (!canPlay) return
    setCurrentWord((previous) => previous.slice(0, -1))
  }, [canPlay])

  const shuffle = useCallback(() => {
    if (!canPlay) return
    setIsShuffling(true)
    window.setTimeout(() => setIsShuffling(false), 300)
    setOuterOrder((previous) => {
      const next = [...previous]
      for (let index = next.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1))
        ;[next[index], next[swap]] = [next[swap], next[index]]
      }
      return next
    })
  }, [canPlay])

  const submitWord = useCallback(async () => {
    if (!puzzle || !canPlay) return
    const word = currentWord.toLowerCase()
    if (word.length === 0) return

    if (word.length < 4) {
      showToast(flashShake('Too short'))
      return
    }
    if (!word.includes(centerLetter)) {
      showToast(flashShake('Missing center letter'))
      return
    }
    if (foundSet.has(word)) {
      showToast(flashShake('Already found'))
      return
    }

    try {
      const response = await requestJson<SpellingBeeGuessResponse>(
        '/api/games/spellingbee/guess',
        {
          body: JSON.stringify({ date: puzzle.date, word }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      )

      if (!response.valid) {
        showToast(flashShake(REASON_MESSAGES[response.reason ?? ''] ?? 'Not in word list'))
        return
      }

      const points = response.score ?? scoreWord(word)
      const nextWords = [...foundWords, word]
      setFoundWords(nextWords)
      setCurrentWord('')
      setPop(true)
      window.setTimeout(() => setPop(false), 220)
      persistLocal(puzzle.date, nextWords)
      scheduleSync(puzzle.date, nextWords)

      if (response.isPangram) {
        showToast(`Pangram! +${points}`, 2000)
      } else {
        const praise = PRAISE[Math.min(PRAISE.length - 1, Math.max(0, Math.floor(points / 3)))]
        showToast(`${praise} +${points}`, 1200)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not check word')
    }
  }, [
    canPlay,
    centerLetter,
    currentWord,
    flashShake,
    foundSet,
    foundWords,
    persistLocal,
    puzzle,
    scheduleSync,
    showToast,
  ])

  // Physical keyboard: valid letters type, Backspace deletes, Enter submits.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!canPlay) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Enter') {
        event.preventDefault()
        void submitWord()
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        deleteLetter()
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        const letter = event.key.toLowerCase()
        if (validLetters.has(letter)) {
          event.preventDefault()
          addLetter(letter)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addLetter, canPlay, deleteLetter, submitWord, validLetters])

  const cellLetters = useMemo(() => {
    if (!puzzle) return []
    // Cell 0 is always the centre; the six outer letters follow the shuffle order.
    return [puzzle.centerLetter, ...outerOrder.map((index) => puzzle.outerLetters[index])]
  }, [outerOrder, puzzle])

  const sortedFound = useMemo(() => [...foundWords].sort(), [foundWords])


  return (
    <main className="game-page game-page--spellingbee" aria-label="Spelling Bee game">
      <section className="game-panel spellingbee-panel">
        {puzzleError && (
          <div className="game-error">
            <span>{puzzleError}</span>
            <button className="game-secondary-button" onClick={() => void loadPuzzle()} type="button">
              Retry
            </button>
          </div>
        )}

        {!puzzle && !puzzleError && <p className="game-loading">Loading Spelling Bee...</p>}

        {puzzle && (
          <>
            <RankBar
              ranks={puzzle.ranks}
              rankIndex={rankIndex}
              rankTitle={isQueenBee ? 'Queen Bee' : rankTitle}
              score={score}
            />

            {foundWords.length === 0 ? (
              <div className="spellingbee-found-card spellingbee-found-card--empty">
                <span className="spellingbee-found-placeholder">
                  Your found words will appear here
                </span>
              </div>
            ) : (
              <div className="spellingbee-found-card">
                <div className="spellingbee-found-header">
                  <span className="spellingbee-found-header__title">Your Words</span>
                  <span className="spellingbee-found-header__count">
                    {foundWords.length}
                  </span>
                </div>
                <ul className="spellingbee-found-grid" aria-label="Words found">
                  {sortedFound.map((word) => (
                    <li
                      key={word}
                      className={isPangramWord(word) ? 'spellingbee-word--pangram' : ''}
                    >
                      {word}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div
              className={[
                'spellingbee-input',
                shake ? 'spellingbee-input--shake' : '',
                pop ? 'spellingbee-input--pop' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-live="polite"
            >
              {currentWord.length === 0 ? (
                <span className="spellingbee-input__placeholder" />
              ) : (
                currentWord.split('').map((letter, index) => {
                  const lower = letter.toLowerCase()
                  const isCenter = lower === centerLetter
                  const isInvalid = !validLetters.has(lower)
                  return (
                    <span
                      key={`${letter}-${index}`}
                      className={[
                        'spellingbee-input__letter',
                        isCenter ? 'spellingbee-input__letter--center' : '',
                        isInvalid ? 'spellingbee-input__letter--invalid' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {letter}
                    </span>
                  )
                })
              )}
            </div>

            <div className={['spellingbee-hive', isShuffling ? 'spellingbee-hive--shuffling' : ''].filter(Boolean).join(' ')}>
              {cellLetters.map((letter, index) => (
                <button
                  key={index}
                  className={['spellingbee-cell', index === 0 ? 'spellingbee-cell--center' : ''].filter(Boolean).join(' ')}
                  style={CELL_POSITIONS[index]}
                  type="button"
                  onClick={() => addLetter(letter)}
                  disabled={!canPlay}
                  aria-label={`Letter ${letter}${index === 0 ? ' (center, required)' : ''}`}
                >
                  <svg viewBox="0 0 100 86.6" aria-hidden="true" className="spellingbee-cell__hexagon">
                    <polygon className="spellingbee-cell__fill" points={HEX_POINTS} />
                  </svg>
                  <span className="spellingbee-cell__letter">{letter}</span>
                </button>
              ))}
            </div>

            <div className="spellingbee-actions">
              <button
                className="game-secondary-button"
                onClick={deleteLetter}
                type="button"
                disabled={currentWord.length === 0}
              >
                Delete
              </button>
              <button
                className="game-secondary-button spellingbee-shuffle"
                onClick={shuffle}
                type="button"
                aria-label="Shuffle letters"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18 4l3 3-3 3M21 7h-5.5a5 5 0 0 0-4 2l-3 4a5 5 0 0 1-4 2H3M18 20l3-3-3-3M21 17h-5.5a5 5 0 0 1-4-2M3 7h1.5a5 5 0 0 1 4 2"
                  />
                </svg>
              </button>
              <button
                className="game-primary-button"
                onClick={() => void submitWord()}
                type="button"
                disabled={currentWord.length === 0}
              >
                Enter
              </button>
            </div>


          </>
        )}
      </section>
    </main>
  )
}

function RankBar({
  ranks,
  rankIndex,
  rankTitle,
  score,
}: {
  ranks: { title: string; minScore: number }[]
  rankIndex: number
  rankTitle: string
  score: number
}) {
  // Show the nine standard tiers (Beginner…Genius) evenly along the line; Queen
  // Bee lives beyond the bar and only surfaces as the rank label when achieved.
  const tiers = ranks.slice(0, 9)
  return (
    <div className="spellingbee-rankbar">
      <span className="spellingbee-rankbar__title">{rankTitle}</span>
      <div className="spellingbee-rankbar__track">
        <div className="spellingbee-rankbar__line" />
        {tiers.map((tier, index) => {
          const isCurrent = index === Math.min(rankIndex, tiers.length - 1)
          const reached = rankIndex >= index
          const left = tiers.length > 1 ? (index / (tiers.length - 1)) * 100 : 0
          return (
            <span
              key={tier.title}
              className={[
                'spellingbee-rankbar__dot',
                reached ? 'spellingbee-rankbar__dot--reached' : '',
                isCurrent ? 'spellingbee-rankbar__dot--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: `${left}%` }}
              title={`${tier.title} (${tier.minScore})`}
            >
              {isCurrent ? score : ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}
