from typing_extensions import TypedDict


class ToolState(TypedDict):
    tool_id: str
    attempt: int


class ToolInput(TypedDict):
    tool_id: str
    attempt: int


class ToolOutput(TypedDict):
    tool_id: str
    attempt: int


class ToolEvent(TypedDict):
    tool_id: str
    attempt: int
