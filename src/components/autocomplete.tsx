"use client";
import { useId, useState, type InputHTMLAttributes } from "react";
import { autocompleteSuggestions } from "@/domain/autocomplete";
export default function AutocompleteInput({
  suggestions,
  onChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  suggestions: (string | null | undefined)[];
}) {
  const id = useId();
  const [query, setQuery] = useState(
    String(props.value ?? props.defaultValue ?? ""),
  );
  const choices = autocompleteSuggestions(
    suggestions,
    props.value !== undefined ? String(props.value) : query,
  );
  return (
    <>
      <input
        {...props}
        list={id}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange?.(e);
        }}
      />
      <datalist id={id}>
        {choices.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </>
  );
}
