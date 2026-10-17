"use client";
import { Check, Copy } from "lucide-react";
import { useToast } from "./toasts";
import { useEffect, useRef, useState } from "react";

export default function CopyCode({ value }: { value: string }) {
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="copy-code-button"
      aria-label={`Copiar código ML ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
          notify("Código ML copiado.");
        } catch {
          notify(
            "Não foi possível copiar o código. Selecione e copie o texto ao lado.",
            "error",
          );
        }
      }}
    >
      {copied ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
    </button>
  );
}
