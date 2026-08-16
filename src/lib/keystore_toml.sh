# shellcheck shell=sh
# Minimal TOML helpers for the OhMyKeymint backend.

# -- TOML helpers (private) --
# Deliberately minimal: only understands the two shapes Specter needs to
# read/write (a top-level `scoop = [...]` array and a `KEY = VALUE` line
# inside a `[trust]` table), not the full TOML grammar.

_toml_read_scoop() {
  _trs_file="$1"
  [ -f "$_trs_file" ] || return 0
  awk '
    BEGIN { capture = 0 }
    {
      line = $0
      if (!capture) {
        if (line ~ /^[ ]*scoop[ ]*=/) {
          capture = 1
          sub(/^[ ]*scoop[ ]*=[ ]*/, "", line)
        } else {
          next
        }
      }
      while (match(line, /"[^"]*"/)) {
        print substr(line, RSTART + 1, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
      }
      if (line ~ /\]/) capture = 0
    }
  ' "$_trs_file"
}

# stdin packages → rewrite scoop in FILE; leave other keys alone.
_toml_write_scoop() {
  _tws_file="$1"
  [ -f "$_tws_file" ] || { unset _tws_file; return 1; }

  _tws_block="${_tws_file}.block.$$"
  {
    printf 'scoop = [\n'
    while IFS= read -r _tws_pkg || [ -n "$_tws_pkg" ]; do
      [ -z "$_tws_pkg" ] && continue
      printf '  "%s",\n' "$_tws_pkg"
    done
    printf ']\n'
  } > "$_tws_block"

  _tws_tmp="${_tws_file}.new.$$"

  if grep -Eq '^[ ]*scoop[ ]*=' "$_tws_file"; then
    awk -v blockfile="$_tws_block" '
      function emit(   line) { while ((getline line < blockfile) > 0) print line; close(blockfile) }
      {
        if (capture) { if ($0 ~ /\]/) capture = 0; next }
        if ($0 ~ /^[ ]*scoop[ ]*=/) {
          emit()
          if ($0 !~ /\]/) capture = 1
          next
        }
        print
      }
    ' "$_tws_file" > "$_tws_tmp"
  elif grep -Eq '^[ ]*\[' "$_tws_file"; then
    awk -v blockfile="$_tws_block" '
      function emit(   line) { while ((getline line < blockfile) > 0) print line; close(blockfile) }
      BEGIN { injected = 0 }
      {
        if (!injected && $0 ~ /^[ ]*\[/) { emit(); injected = 1 }
        print
      }
    ' "$_tws_file" > "$_tws_tmp"
  else
    cat "$_tws_block" > "$_tws_tmp"
    if [ -s "$_tws_file" ]; then
      printf '\n' >> "$_tws_tmp"
      cat "$_tws_file" >> "$_tws_tmp"
    fi
  fi

  _ksm_inplace_from "$_tws_tmp" "$_tws_file" || {
    rm -f "$_tws_tmp" "$_tws_block"
    unset _tws_file _tws_block _tws_tmp _tws_pkg
    return 1
  }
  rm -f "$_tws_tmp" "$_tws_block"
  unset _tws_file _tws_block _tws_tmp _tws_pkg
}

# VALUE must already be TOML-shaped (quoted string, bare number/bool, …).
_toml_set_trust_key() {
  _tsk_file="$1" _tsk_key="$2" _tsk_val="$3"
  [ -f "$_tsk_file" ] || { unset _tsk_file _tsk_key _tsk_val; return 1; }

  _tsk_tmp="${_tsk_file}.new.$$"

  if grep -Eq '^\[trust\]' "$_tsk_file"; then
    awk -v key="$_tsk_key" -v val="$_tsk_val" '
      BEGIN { in_trust = 0; done = 0 }
      /^\[/ {
        if (in_trust && !done) { print key " = " val; done = 1 }
        in_trust = ($0 == "[trust]")
        print
        next
      }
      {
        if (in_trust && !done && $0 ~ ("^[ ]*" key "[ ]*=")) {
          print key " = " val
          done = 1
          next
        }
        print
      }
      END {
        if (in_trust && !done) print key " = " val
      }
    ' "$_tsk_file" > "$_tsk_tmp"
  else
    cat "$_tsk_file" > "$_tsk_tmp"
    printf '\n[trust]\n%s = %s\n' "$_tsk_key" "$_tsk_val" >> "$_tsk_tmp"
  fi

  _ksm_inplace_from "$_tsk_tmp" "$_tsk_file" || {
    rm -f "$_tsk_tmp"
    unset _tsk_file _tsk_key _tsk_val _tsk_tmp
    return 1
  }
  rm -f "$_tsk_tmp"
  unset _tsk_file _tsk_key _tsk_val _tsk_tmp
}

_toml_get_trust_key() {
  _tgk_file="$1" _tgk_key="$2"
  [ -f "$_tgk_file" ] || return 1
  grep -E '^[ ]*'"$_tgk_key"'[ ]*=' "$_tgk_file" 2>/dev/null \
    | head -1 | sed 's/.*=[ ]*//; s/^"//; s/"$//; s/[[:space:]]*$//'
  unset _tgk_file _tgk_key
}
