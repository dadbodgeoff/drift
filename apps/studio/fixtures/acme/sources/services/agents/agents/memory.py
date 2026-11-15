from typing_extensions import TypedDict


class MemoryState(TypedDict):
    memory_id: str
    attempt: int


class MemoryInput(TypedDict):
    memory_id: str
    attempt: int


class MemoryOutput(TypedDict):
    memory_id: str
    attempt: int


class MemoryEvent(TypedDict):
    memory_id: str
    attempt: int
