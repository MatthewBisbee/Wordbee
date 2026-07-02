from __future__ import annotations

from functools import lru_cache
from pathlib import Path


EvaluatedState = str
VALID_GUESSES_PATH = Path(__file__).resolve().parents[1] / "valid-wordbee-words.txt"


def score_guess(answer: str, guess: str) -> list[EvaluatedState]:
    answer_letters = list(answer.upper())
    guess_letters = list(guess.upper())
    result: list[EvaluatedState] = ["absent"] * len(answer_letters)

    for index, letter in enumerate(guess_letters):
        if letter == answer_letters[index]:
            result[index] = "correct"
            answer_letters[index] = ""
            guess_letters[index] = ""

    for index, letter in enumerate(guess_letters):
        if not letter:
            continue

        try:
            answer_index = answer_letters.index(letter)
        except ValueError:
            continue

        result[index] = "present"
        answer_letters[answer_index] = ""

    return result


def normalize_guess(raw_guess: object, answer_length: int) -> str | None:
    if not isinstance(raw_guess, str):
        return None

    guess = raw_guess.strip().upper()
    if len(guess) != answer_length or not guess.isalpha():
        return None

    return guess


def is_valid_guess(guess: str, answer: str) -> bool:
    return guess == answer.upper() or guess in load_valid_guesses()


@lru_cache
def load_valid_guesses() -> set[str]:
    return {
        word.strip().upper()
        for word in VALID_GUESSES_PATH.read_text(encoding="utf-8").splitlines()
        if word.strip()
    }
