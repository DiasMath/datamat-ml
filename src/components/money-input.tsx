"use client";
import { useRef, useState, type InputHTMLAttributes } from "react";
import Decimal from "decimal.js";
import {
  centsInput,
  pastedMoney,
  moneyInputDisplay,
} from "../domain/money-input";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"
> & {
  value?: string | null;
  defaultValue?: string | number | null;
  onValueChange?: (value: string) => void;
  maxAmount?: string;
};
export default function MoneyInput({
  value,
  defaultValue,
  onValueChange,
  name,
  maxAmount = "1000000000",
  className = "",
  ...props
}: Props) {
  const [internal, setInternal] = useState(
    defaultValue == null ? "" : String(defaultValue),
  );
  const hidden = useRef<HTMLInputElement>(null);
  const current = value !== undefined ? (value ?? "") : internal;
  function commit(raw: string, input: HTMLInputElement) {
    if (raw && new Decimal(raw).gt(maxAmount)) {
      input.value = moneyInputDisplay(current);
      return;
    }
    // FormData must see the canonical value in the same bubbling change event.
    // Keep supplier costs with six decimals untouched until the user edits them.
    if (hidden.current) hidden.current.value = raw;
    input.value = moneyInputDisplay(raw);
    setInternal(raw);
    onValueChange?.(raw);
    requestAnimationFrame(() => {
      if (document.activeElement === input)
        input.setSelectionRange(input.value.length, input.value.length);
    });
  }
  return (
    <>
      {name && (
        <input
          type="hidden"
          ref={hidden}
          name={name}
          value={current}
          readOnly
        />
      )}
      <input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={`money-input ${className}`}
        value={moneyInputDisplay(current)}
        onChange={() => {}}
        onInput={(e) =>
          commit(centsInput(e.currentTarget.value), e.currentTarget)
        }
        onPaste={(e) => {
          e.preventDefault();
          const raw = pastedMoney(e.clipboardData.getData("text"));
          if (raw === null) return;
          const input = e.currentTarget;
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!.call(input, moneyInputDisplay(raw));
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }}
      />
    </>
  );
}
