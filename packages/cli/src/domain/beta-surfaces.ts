import {
  BetaDoctorResponseSchema,
  BetaStartResponseSchema,
  type BetaDoctorResponse,
  type BetaStartResponse
} from "@drift/core";

export function betaStartResponse(payload: unknown): BetaStartResponse {
  return BetaStartResponseSchema.parse(payload);
}

export function betaDoctorResponse(payload: unknown): BetaDoctorResponse {
  return BetaDoctorResponseSchema.parse(payload);
}
