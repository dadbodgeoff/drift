from typing_extensions import TypedDict
import typing


class HandoffState(TypedDict):
    handoff_id: str
    attempt: int


class HandoffInput(TypedDict):
    handoff_id: str
    attempt: int


class HandoffOutput(TypedDict):
    handoff_id: str
    attempt: int


class HandoffEvent(typing.TypedDict):
    handoff_id: str
    attempt: int
