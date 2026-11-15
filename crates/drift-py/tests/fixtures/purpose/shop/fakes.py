from shop.payments import Gateway, Ledger


class InMemoryGateway(Gateway):
    def charge(self, cents: int) -> str:
        return "fake"


def make_order():
    return None


class InMemoryLedger(Ledger):
    entries = []
