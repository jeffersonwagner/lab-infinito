"use client";

import { useEffect, useRef } from "react";

// PRD RF-09: polling a cada 5 s enquanto a aba está visível e ao voltar à
// aba, pausado quando oculta. A atualização só altera o estado do servidor
// (projeções); entradas de formulário ainda não enviadas são estado React
// separado e nunca são apagadas pelo polling.
export function usePolling(
  atualizar: () => void | Promise<void>,
  intervaloMs = 5000,
  ativo = true,
): void {
  const callbackRef = useRef(atualizar);
  useEffect(() => {
    callbackRef.current = atualizar;
  });

  useEffect(() => {
    if (!ativo || typeof window === "undefined") {
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const iniciar = () => {
      if (timer === null) {
        timer = setInterval(() => {
          if (document.visibilityState === "visible") {
            void callbackRef.current();
          }
        }, intervaloMs);
      }
    };
    const parar = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "visible") {
        // RF-09: atualizar imediatamente ao voltar à aba.
        void callbackRef.current();
        iniciar();
      } else {
        parar();
      }
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    if (document.visibilityState === "visible") {
      iniciar();
    }
    return () => {
      parar();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [intervaloMs, ativo]);
}
