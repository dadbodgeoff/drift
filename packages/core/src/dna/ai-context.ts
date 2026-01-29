import type { StylingDNAProfile } from './types.js';

export type ContextLevel = 1 | 2 | 3 | 4;

export class AIContextBuilder {
  build(profile: StylingDNAProfile, level: ContextLevel = 3): string {
    switch (level) {
      case 1: return this.buildLevel1(profile);
      case 2: return this.buildLevel2(profile);
      case 3: return this.buildLevel3(profile);
      case 4: return this.buildLevel4(profile);
      default: return this.buildLevel3(profile);
    }
  }

  private buildLevel1(p: StylingDNAProfile): string {
    const fw = p.summary.dominantFramework;
    const genes = Object.values(p.genes).filter(g => g.dominant).map(g => g.dominant?.name).join(', ');
    return `${fw} codebase using ${genes}. Health: ${p.summary.healthScore}/100.`;
  }

  private buildLevel2(p: StylingDNAProfile): string {
    const lines = ['## Styling Conventions', '', '| Concern | Approach | Confidence |', '|---------|----------|------------|'];
    for (const g of Object.values(p.genes)) {
      lines.push(`| ${g.name} | ${g.dominant?.name ?? 'None'} | ${Math.round(g.confidence * 100)}% |`);
    }
    lines.push('', `Health Score: ${p.summary.healthScore}/100`);
    return lines.join('\n');
  }

  private buildLevel3(p: StylingDNAProfile): string {
    const lines = [`# Styling Conventions (${p.summary.dominantFramework})`, ''];
    for (const g of Object.values(p.genes)) {
      if (!g.dominant) {continue;}
      lines.push(`## ${g.name}`, `Use ${g.dominant.name}:`, '```tsx');
      const ex = g.dominant.examples[0];
      if (ex) {lines.push(ex.code);}
      lines.push('```', '');
    }
    if (p.mutations.length > 0) {
      lines.push('---', `⚠️ ${p.mutations.length} mutations detected`);
      for (const m of p.mutations.slice(0, 3)) {lines.push(`- ${m.file}: ${m.actual}`);}
    }
    return lines.join('\n');
  }

  private buildLevel4(p: StylingDNAProfile): string {
    return JSON.stringify(p, null, 2);
  }
}
