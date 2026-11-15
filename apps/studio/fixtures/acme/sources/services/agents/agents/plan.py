from typing_extensions import TypedDict


class PlanState(TypedDict):
    plan_id: str
    attempt: int


class PlanInput(TypedDict):
    plan_id: str
    attempt: int


class PlanOutput(TypedDict):
    plan_id: str
    attempt: int


class PlanEvent(TypedDict):
    plan_id: str
    attempt: int
