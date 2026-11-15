from abc import ABC, abstractmethod


class Gateway(ABC):
    @abstractmethod
    def send(self, payload: dict) -> None: ...


class HttpGateway(Gateway):
    def send(self, payload: dict) -> None:
        return None
