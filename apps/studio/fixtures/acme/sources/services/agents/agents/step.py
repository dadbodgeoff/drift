from typing_extensions import TypedDict


class StepState(TypedDict):
    step_id: str
    attempt: int


class StepInput(TypedDict):
    step_id: str
    attempt: int


class StepOutput(TypedDict):
    step_id: str
    attempt: int


class StepEvent(TypedDict):
    step_id: str
    attempt: int
