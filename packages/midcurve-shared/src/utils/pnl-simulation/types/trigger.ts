export type TriggerDirection = 'above' | 'below';

export interface Trigger {
  /** Unique trigger identifier */
  id: string;
  /** Trigger price in quote token units */
  price: bigint;
  /** Trigger when price crosses above/below this threshold */
  direction: TriggerDirection;
  /** If true, only triggers once per simulation session */
  oneShot: boolean;
}
