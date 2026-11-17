/**
 * Runs the KieAI result poller while a project is open. A component of its own so App can load it
 * lazily: the poller writes into the project store, which the start page does not download.
 */
import { useKieAIPoller } from "../hooks/useKieAIPoller";

export default function KieAIPoller(): null {
  useKieAIPoller();
  return null;
}
