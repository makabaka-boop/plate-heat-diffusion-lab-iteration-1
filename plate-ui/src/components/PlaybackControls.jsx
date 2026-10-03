export default function PlaybackControls({
  frame,
  steps,
  playing,
  speed,
  onPlay,
  onPause,
  onSeek,
  onSpeedChange,
}) {
  return (
    <div className="playback">
      <button data-testid="play-button" onClick={playing ? onPause : onPlay}>
        {playing ? "暂停" : "播放"}
      </button>
      <button
        data-testid="prev-frame"
        disabled={frame <= 0}
        onClick={() => onSeek(frame - 1)}
      >
        ◀
      </button>
      <button
        data-testid="next-frame"
        disabled={frame >= steps}
        onClick={() => onSeek(frame + 1)}
      >
        ▶
      </button>
      <input
        data-testid="frame-slider"
        type="range"
        min={0}
        max={steps}
        value={frame}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span data-testid="frame-indicator" className="frame-indicator">
        帧 {frame}/{steps}
      </span>
      <select
        data-testid="speed-select"
        value={speed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
      >
        <option value={800}>慢速</option>
        <option value={400}>中速</option>
        <option value={150}>快速</option>
      </select>
    </div>
  );
}
