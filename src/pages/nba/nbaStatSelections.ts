const NBA_STAT_MODULES = import.meta.glob('../../sport/nba/type/stats/*.json', {
    eager: true,
});

export function getMergedSelectionsForStatPrefix<TSelection>(
    prefix: string,
): TSelection[] {
    const normalizedPrefix = prefix.trim().toLowerCase();
    if (!normalizedPrefix) return [];

    const merged: TSelection[] = [];

    for (const [path, mod] of Object.entries(NBA_STAT_MODULES)) {
        const filename = path.split('/').pop()?.toLowerCase() ?? "";
        if (!filename.startsWith(normalizedPrefix)) continue;

        const moduleRecord = mod as unknown as { default?: unknown };
        const payload = moduleRecord.default ?? mod;
        const selections = (payload as { selections?: unknown }).selections;

        if (Array.isArray(selections)) {
            merged.push(...(selections as TSelection[]));
        }
    }

    return merged;
}
