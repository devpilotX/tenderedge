/**
 * Minimal robots.txt policy (REQ 4.3). Parses Disallow/Allow rules for the relevant
 * user-agent group and decides whether a path may be fetched. Conservative: if the
 * policy can't be parsed it is treated as permissive only for the empty disallow set,
 * and the caller logs every exclusion.
 */
export interface RobotsPolicy {
  isAllowed(path: string): boolean;
}

interface Rule {
  type: 'allow' | 'disallow';
  path: string;
}

export function parseRobots(content: string, userAgent = '*'): RobotsPolicy {
  const lines = content.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const line of lines) {
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'disallow' || field === 'allow') {
      if (current) current.rules.push({ type: field, path: value });
      lastWasAgent = false;
    }
  }

  const ua = userAgent.toLowerCase();
  const group =
    groups.find((g) => g.agents.includes(ua)) ?? groups.find((g) => g.agents.includes('*'));
  const rules = group?.rules ?? [];

  return {
    isAllowed(path: string): boolean {
      // Longest-match rule wins; Allow beats Disallow at equal specificity.
      let decision: { allow: boolean; len: number } | null = null;
      for (const rule of rules) {
        if (rule.path === '') continue; // empty Disallow means "allow all"
        if (path.startsWith(rule.path)) {
          const len = rule.path.length;
          if (!decision || len > decision.len || (len === decision.len && rule.type === 'allow')) {
            decision = { allow: rule.type === 'allow', len };
          }
        }
      }
      return decision ? decision.allow : true;
    },
  };
}

/** A policy that allows everything (used when a portal publishes no robots.txt). */
export const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true };
