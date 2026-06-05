const cache = new Map<string, HTMLImageElement>();

export function preloadImages(urls: string[]): Promise<void[]> {
  const unique = [...new Set(urls.filter(Boolean))];
  return Promise.all(
    unique.map(
      (url) =>
        new Promise<void>((resolve) => {
          if (cache.has(url)) {
            resolve();
            return;
          }
          const img = new Image();
          img.onload = () => {
            cache.set(url, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  );
}

export function collectImageUrls(
  configurator: import("~/lib/configurator.types").StorefrontConfigurator,
): string[] {
  const urls: string[] = [];
  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      for (const opt of group.options) {
        if (opt.imageUrl) urls.push(opt.imageUrl);
        if (opt.previewLayer) urls.push(opt.previewLayer);
      }
    }
  }
  for (const addon of configurator.addons) {
    if (addon.imageUrl) urls.push(addon.imageUrl);
  }
  return urls;
}
