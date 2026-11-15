from abc import ABC, abstractmethod


class Gateway(ABC):
    @abstractmethod
    def charge(self, cents: int) -> str: ...


class Refunds:
    @abstractmethod
    def refund(self, charge_id: str) -> None: ...


class StripeGateway(Gateway):
    def charge(self, cents: int) -> str:
        return "ch_1"


class Order:
    total = 0


class Invoice:
    number = ""


class Ledger:
    entries = ()
