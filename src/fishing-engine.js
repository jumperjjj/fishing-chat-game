class FishingEngine {
  constructor(database, broadcast) {
    this.db = database;
    this.broadcast = broadcast;
    this.queue = Promise.resolve();
  }

  weightedPick(items) {
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight)), 0);
    if (!total) return null;

    let roll = Math.random() * total;
    for (const item of items) {
      roll -= Math.max(0, Number(item.weight));
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }

  getChanceMap(items) {
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight)), 0);
    return items.map((item) => ({
      ...item,
      chance: total > 0 ? (Number(item.weight) / total) * 100 : 0
    }));
  }

  async fish({ channelId, user, bypassCooldown = false }) {
    const settings = this.db.getSettings();
    const cooldownMs = Math.max(0, Number(settings.cooldown_seconds || 120)) * 1000;
    const player = this.db.ensurePlayer(channelId, user);
    const elapsed = Date.now() - Number(player.last_fished_at || 0);

    if (!bypassCooldown && elapsed < cooldownMs) {
      return {
        ok: false,
        reason: 'cooldown',
        remainingSeconds: Math.ceil((cooldownMs - elapsed) / 1000)
      };
    }

    // Reserva o cooldown imediatamente para impedir spam enquanto a animação está na fila.
    this.db.markFishingStarted(channelId, user);

    const job = async () => {
      const latestSettings = this.db.getSettings();
      const fishingMs = Math.max(0, Number(latestSettings.fishing_seconds || 4)) * 1000;
      const items = this.db.getEnabledItems();
      const item = this.weightedPick(items);
      if (!item) return { ok: false, reason: 'no_items' };

      this.broadcast({ type: 'fishing:start', user, durationMs: fishingMs });
      await new Promise((resolve) => setTimeout(resolve, fishingMs));

      const updatedPlayer = this.db.applyCatch(channelId, user, item);
      const payload = {
        type: 'fishing:result',
        user,
        item,
        player: {
          gold: updatedPlayer.gold,
          totalCatches: updatedPlayer.total_catches
        }
      };
      this.broadcast(payload);

      // Pequeno espaço visual entre uma pescaria e a próxima da fila.
      await new Promise((resolve) => setTimeout(resolve, 700));
      return { ok: true, ...payload };
    };

    const resultPromise = this.queue.then(job, job);
    this.queue = resultPromise.catch(() => {});
    return resultPromise;
  }
}

module.exports = { FishingEngine };
