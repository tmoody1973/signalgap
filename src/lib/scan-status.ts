/** A scan is finished when it is completed, partial or canceled. Anything else still has work in flight. */
export const isScanFinished = (status: string): boolean =>
  status === "completed" || status === "partial" || status === "canceled";
