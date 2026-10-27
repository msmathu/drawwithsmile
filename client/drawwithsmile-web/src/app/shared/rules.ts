import { CHAOS_RULES, LANGUAGES, type RoomSettings } from '@dws/shared';

/** Short, human-readable list of a room's rules (for players who can't edit them). */
export function rulesSummary(s: RoomSettings): string[] {
  const lines = [
    `⏱️ ${s.drawTime}s to draw · ${s.rounds} round${s.rounds === 1 ? '' : 's'} · up to ${s.maxPlayers} players`,
    `🔤 ${LANGUAGES.find((l) => l.code === s.language)?.label ?? s.language} · ${s.difficulty} words${s.categories.length ? ` · ${s.categories.join(', ')}` : ''}`,
  ];
  if (s.mode === 'chaos') {
    const names = CHAOS_RULES.filter((r) => s.chaosRules.includes(r.id)).map((r) => `${r.icon} ${r.name}`);
    lines.push(`🌪️ Chaos mode${s.chaosRandom ? ' (random mix each turn)' : ''}: ${names.join(', ')}`);
  }
  if (s.collaborative) lines.push(`🤝 ${s.artistCount} artists share each drawing, ${s.artistSeconds}s each`);
  if (s.teams) {
    lines.push(
      `⚔️ Team Battle: ${s.teamCount} teams, ${s.teamAssignment === 'auto' ? 'auto teams' : 'pick your team'}, ${s.teamScoring} scoring${s.teamBonus ? `, +${s.teamBonus} team bonus` : ''}`,
    );
  }
  if (s.voting) lines.push(`🗳️ Vote after each round (${s.votingSeconds}s)${s.voteBonus ? `, winners +${s.voteBonus}` : ''}`);
  const extras = [s.hints ? 'hints on' : 'no hints', s.reactions ? 'reactions on' : 'no reactions', s.lateJoin ? 'late joining allowed' : 'no late joining'];
  lines.push(`⚙️ ${extras.join(' · ')}`);
  return lines;
}
