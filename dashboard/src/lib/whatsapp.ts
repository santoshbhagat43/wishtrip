/** WhatsApp sign-in codes need Trustsignal's WhatsApp channel, which isn't set up yet. The sign-in
 *  page shows the WhatsApp option so it looks complete, and says it isn't available yet when used.
 *  Flip this to true once the backend can send WhatsApp codes (and remove the backend's note). */
export const WHATSAPP_READY = false;

export const WHATSAPP_NOT_READY = "WhatsApp codes aren't available yet. Please use your email.";
