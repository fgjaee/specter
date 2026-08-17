# shellcheck shell=sh
# txt-backend target.txt rewriting: section-preserving merge and
# default-block insertion (see ksm_commit_targets_merge in keystore.sh).

# Rewrite target.txt from $1: packages keep their [name.xml] section
# membership, package lines take the desired suffix, deselected packages are
# dropped, new packages land in the default (pre-section) block.
_ksm_txt_merge() {
  _ktm_src="$1"
  _ktm_out="${KSM_TARGETS}.new.$$"
  awk -v srcfile="$_ktm_src" '
    BEGIN {
      while ((getline l < srcfile) > 0) {
        sub(/\r$/, "", l)
        if (l ~ /^[[:space:]]*$/ || l ~ /^[[:space:]]*\[/) continue
        base = l
        sub(/[!?][[:space:]]*$/, "", base)
        if (base == "") continue
        want[base] = l
        if (!(base in ordered)) { ordered[base] = 1; order[++n] = base }
      }
      close(srcfile)
    }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ /^[[:space:]]*\[/) { sect[++nsect] = line; next }
      if (line ~ /^[[:space:]]*$/ || line ~ /^[[:space:]]*#/) next
      base = line
      sub(/[!?][[:space:]]*$/, "", base)
      if ((base in want) && !(base in seen)) {
        seen[base] = 1
        if (nsect > 0) sec_of[base] = nsect
      }
    }
    END {
      for (i = 1; i <= n; i++) {
        if (order[i] in sec_of) continue
        print want[order[i]]
      }
      for (s = 1; s <= nsect; s++) {
        print sect[s]
        for (i = 1; i <= n; i++) {
          if ((order[i] in sec_of) && sec_of[order[i]] == s) print want[order[i]]
        }
      }
    }
  ' "$KSM_TARGETS" > "$_ktm_out" || {
    rm -f "$_ktm_out"
    unset _ktm_src _ktm_out
    return 1
  }
  rm -f "${KSM_TARGETS}.bak"
  cp "$KSM_TARGETS" "${KSM_TARGETS}.bak"
  mv -f "$_ktm_out" "$KSM_TARGETS" || {
    rm -f "$_ktm_out"
    unset _ktm_src _ktm_out
    return 1
  }
  unset _ktm_src _ktm_out
}

# Insert the lines from $2 into $1's default block, i.e. before the first
# [name.xml] section header (appended when no sections exist). Keeps new
# packages scoped to the default keybox instead of the last section.
_txt_insert_default() {
  _tid_file="$1" _tid_add="$2"
  [ -s "$_tid_add" ] || { unset _tid_file _tid_add; return 0; }
  _tid_tmp="${_tid_file}.new.$$"
  awk -v add="$_tid_add" '
    BEGIN { inserted = 0 }
    !inserted && /^[[:space:]]*\[/ {
      while ((getline l < add) > 0) { if (l != "") print l }
      close(add)
      inserted = 1
    }
    { print }
    END {
      if (!inserted) {
        while ((getline l < add) > 0) { if (l != "") print l }
        close(add)
      }
    }
  ' "$_tid_file" > "$_tid_tmp" || {
    rm -f "$_tid_tmp"
    unset _tid_file _tid_add _tid_tmp
    return 1
  }
  mv -f "$_tid_tmp" "$_tid_file" || {
    rm -f "$_tid_tmp"
    unset _tid_file _tid_add _tid_tmp
    return 1
  }
  unset _tid_file _tid_add _tid_tmp
}

# Wait up to $2 seconds (default 10) for $1 to appear.
_ksm_wait_file() {
  _kwf_file="$1" _kwf_tries="${2:-10}" _kwf_i=0
  while [ ! -f "$_kwf_file" ] && [ "$_kwf_i" -lt "$_kwf_tries" ]; do
    sleep 1
    _kwf_i=$((_kwf_i + 1))
  done
  [ -f "$_kwf_file" ]
  _kwf_rc=$?
  unset _kwf_file _kwf_tries _kwf_i
  return $_kwf_rc
}

