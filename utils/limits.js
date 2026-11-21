'use strict';

// utils/limits.js — Message length limits
// Re-verify LinkedIn's current limits before shipping; they change without notice.
// As of 2024: Connection note = 300 chars. DMs have no hard cap but short is better.

const Limits = {
  CONNECTION_NOTE: 300,   // LinkedIn "Add a note" when connecting — hard platform limit
  SHORT_DM:        500,   // Short direct message — fits most screens without scroll
  FULL_MESSAGE:    900,   // Full message — still concise, avoids wall-of-text rejection
};

// Human-readable labels used in the UI length selector
const LimitLabels = {
  CONNECTION_NOTE: `Connection note (${Limits.CONNECTION_NOTE} chars)`,
  SHORT_DM:        `Short message (~${Limits.SHORT_DM} chars)`,
  FULL_MESSAGE:    `Full message (~${Limits.FULL_MESSAGE} chars)`,
};
