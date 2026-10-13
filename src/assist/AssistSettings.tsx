/** Help & settings: what "Ask a doubt" sends and where (nothing to set up — the lab's server holds the Gemini key). */
export function AssistSettingsBlock() {
  return (
    <div className="assist-settings">
      <p className="muted small">
        <b>Ask</b> (beside WHY in every lab) answers your own questions about the circuit on screen, using Google Gemini through the lab’s own server — there is nothing to set up. Your question and the circuit’s simulated values are sent to Google to be answered; no account details and no key are stored in this browser.
      </p>
    </div>
  )
}
