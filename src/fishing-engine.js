class FishingEngine {
  constructor(database, broadcast) {
    this.db = database;
    this.broadcast = broadcast;
    this.queue = Promise.resolve();
  }

  pickByChance(items) {
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.chance || 0)), 0);
    if (!items.length || Math.abs(total - 100) > 0.01) return null;

    let roll = Math.random() * 100;
    for (const item of items) {
      roll -= Math.max(0, Number(item.chance || 0));
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }

  randomGold(item) {
    const min = Math.max(0, Math.floor(Number(item.gold_min) || 0));
    const max = Math.max(min, Math.floor(Number(item.gold_max) || min));
    return Math.floor(Math.random() * (max - min + 1)) + min;
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

    const items = this.db.getFishingItems();
    const chanceTotal = items.reduce((sum, item) => sum + Number(item.chance || 0), 0);
    if (!items.length) return { ok: false, reason: 'no_items' };
    if (Math.abs(chanceTotal - 100) > 0.01) {
      return { ok: false, reason: 'invalid_chance_total', chanceTotal };
    }

    // Reserva o cooldown imediatamente para impedir spam enquanto a animação está na fila.
    this.db.markFishingStarted(channelId, user);

    const job = async () => {
      const latestSettings = this.db.getSettings();
      const fishingMs = Math.max(0, Number(latestSettings.fishing_seconds || 4)) * 1000;
      const latestItems = this.db.getFishingItems();
      const item = this.pickByChance(latestItems);
      if (!item) return { ok: false, reason: 'invalid_chance_total', chanceTotal: this.db.getChanceTotal() };

      this.broadcast({ type: 'fishing:start', user, durationMs: fishingMs });
      await new Promise((resolve) => setTimeout(resolve, fishingMs));

      const goldAwarded = this.randomGold(item);
      const updatedPlayer = this.db.applyCatch(channelId, user, item, goldAwarded);
      const payload = {
        type: 'fishing:result',
        user,
        item: {
          ...item,
          goldAwarded
        },
        player: {
          gold: updatedPlayer.gold,
          totalCatches: updatedPlayer.total_catches
        }
      };
      this.broadcast(payload);

      await new Promise((resolve) => setTimeout(resolve, 650));
      return { ok: true, ...payload };
    };

    const resultPromise = this.queue.then(job, job);
    this.queue = resultPromise.catch(() => {});
    return resultPromise;
  }
}

module.exports = { FishingEngine };
