declare module "chromecasts" {
  interface Chromecast {
    name: string;
    play(
      url: string,
      opts: { title: string },
      cb: (err?: Error) => void,
    ): void;
  }

  interface ChromecastDiscovery {
    on(event: "update", listener: (player: Chromecast) => void): this;
    off(event: "update", listener: (player: Chromecast) => void): this;
    destroy(): void;
  }

  function chromecasts(): ChromecastDiscovery;
  export default chromecasts;
}
