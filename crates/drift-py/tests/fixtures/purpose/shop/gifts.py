from shop.payments import Order


class GiftOrder(Order):
    wrapped = True
