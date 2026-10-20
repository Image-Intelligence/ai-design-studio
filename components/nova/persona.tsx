"use client"

import { createContext, useContext } from "react"
import { NOVA_POSES, PRISM_FACE, PRISM_POSES, type NovaPose } from "./novaArt"
import type { NovaPersonaId } from "@/lib/nova/config"

/*
 * Who is talking (2026-10-20): the chat components are shared by Nova Studio
 * and Prism, the site guide (components/prism). This context gives them the
 * persona's name and art; Nova is the default, so Nova Studio needs no
 * provider.
 */
export type PersonaUI = {
  id: NovaPersonaId
  name: string
  poses: Record<NovaPose, string>
  /** A head-and-shoulders crop for avatar sizes (else the portrait pose). */
  face?: string
}

export const NOVA_UI: PersonaUI = { id: "nova", name: "Nova", poses: NOVA_POSES }
export const PRISM_UI: PersonaUI = { id: "prism", name: "Prism", poses: PRISM_POSES, face: PRISM_FACE }

export const NovaPersonaContext = createContext<PersonaUI>(NOVA_UI)
export const usePersona = () => useContext(NovaPersonaContext)
