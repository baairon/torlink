import { useMemo } from "react";
import { Text, useInput } from "ink";
import { Panel } from "./Panel";
import { FileSelect } from "./FileSelect";
import { useQueueItems } from "../store";
import type { DownloadQueue } from "../../download/queue";

interface DownloadFilesModalProps {
  id: string;
  queue: DownloadQueue;
  onClose: () => void;
  width: number;
  height: number;
}

export function DownloadFilesModal({ id, queue, onClose, width, height }: DownloadFilesModalProps) {
  const items = useQueueItems(queue);
  const item = items.find((it) => it.id === id);
  const deselectedSet = useMemo(() => new Set(item?.deselected ?? []), [item?.deselected]);
  const files = queue.files(id) ?? item?.fileList ?? null;

  useInput((_input, key) => {
    if (key.return || key.escape) onClose();
  });

  const panelH = Math.max(3, height - 1);
  const listH = Math.max(1, panelH - 1);

  return (
    <Panel title="select files" width={width} focused height={panelH}>
      {files === null ? (
        <Text dimColor>Files available once metadata arrives.</Text>
      ) : (
        <FileSelect
          files={files}
          deselected={deselectedSet}
          onToggle={(i) => queue.setFileSelected(id, i, deselectedSet.has(i))}
          active
          focused
          width={Math.max(10, width - 4)}
          height={listH}
        />
      )}
    </Panel>
  );
}
