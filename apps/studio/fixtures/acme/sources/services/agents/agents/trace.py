from typing_extensions import TypedDict


class TraceState(TypedDict):
    trace_id: str
    attempt: int


class TraceInput(TypedDict):
    trace_id: str
    attempt: int


class TraceOutput(TypedDict):
    trace_id: str
    attempt: int


class TraceEvent(TypedDict):
    trace_id: str
    attempt: int
