import Stripe from "stripe";

// `Stripe` is used only as a type, so TypeScript erases the import.
export const METHODS: Stripe.PaymentMethod.Type[] = ["card", "sepa_debit"];
export type Method = Stripe.PaymentMethod;
