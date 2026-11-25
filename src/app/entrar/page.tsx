"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveIdentity } from "@/lib/identity";

// Troca o token do fragmento '#' por uma sessão (cookie), segundo o PRD 8.2,
// e remove o fragmento da URL via History API.
export default function Entrar() {
  const router = useRouter();
  const [state, setState] = useState<"trocando" | "erro" | "redirect">("trocando");
  const [message, setMessage] = useState("Validando seu link…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    async function trocar() {
      const hash = window.location.hash;
      const token = hash.startsWith("#") ? hash.slice(1) : "";
      if (!token) {
        setState("erro");
        setMessage("Link incompleto: abra exatamente o link recebido do professor.");
        return;
      }
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = await res.json();
        window.history.replaceState(null, "", window.location.pathname);
        if (!res.ok) {
          setState("erro");
          setMessage(body.error ?? "Link inválido ou expirado.");
          return;
        }
        saveIdentity(body.identity);
        setState("redirect");
        setMessage("Acessando a sala…");
        router.push(body.identity.role === "PROFESSOR" ? "/professor" : "/grupo");
      } catch {
        window.history.replaceState(null, "", window.location.pathname);
        setState("erro");
        setMessage("Falha de rede. Recarregue esta página para tentar de novo.");
      }
    }
    trocar();
  }, [router]);

  return (
    <main>
      <h1>Entrar na sala</h1>
      <p aria-live="polite">{message}</p>
      {state === "erro" && (
        <p>
          Se o problema persistir, peça ao professor para verificar o link ou
          criar uma nova sala.
        </p>
      )}
    </main>
  );
}
