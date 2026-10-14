import { useId } from 'react';
import {
  File,
  FileImage,
  FileAudio,
  FileVideo,
  FileArchive,
  FileCode2,
  FileText,
} from 'lucide-react';
export function FileIcon({
  name,
  folder,
  large = false,
}: {
  name: string;
  folder: boolean;
  large?: boolean;
}) {
  const gradient = useId();
  if (folder)
    return (
      <svg
        width={large ? 54 : 24}
        height={large ? 46 : 22}
        viewBox="0 0 54 46"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 8a4 4 0 014-4h13l5 6h22a4 4 0 014 4v23a4 4 0 01-4 4H7a4 4 0 01-4-4z"
          fill="#59a8ed"
        />
        <path
          d="M3 17a4 4 0 014-4h40a4 4 0 014 4v20a4 4 0 01-4 4H7a4 4 0 01-4-4z"
          fill={`url(#${gradient})`}
        />
        <defs>
          <linearGradient
            id={gradient}
            x1="27"
            y1="13"
            x2="27"
            y2="41"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#85c6fa" />
            <stop offset="1" stopColor="#3e91da" />
          </linearGradient>
        </defs>
      </svg>
    );
  const ext = name.split('.').at(-1)?.toLowerCase() || '';
  const Icon = /^(jpg|jpeg|png|gif|webp|heic|svg)$/.test(ext)
    ? FileImage
    : /^(mp3|wav|flac|m4a)$/.test(ext)
      ? FileAudio
      : /^(mp4|mkv|mov|avi)$/.test(ext)
        ? FileVideo
        : /^(zip|rar|gz|7z|tar)$/.test(ext)
          ? FileArchive
          : /^(js|ts|tsx|json|html|css|py|rs|go)$/.test(ext)
            ? FileCode2
            : /^(txt|md|pdf|docx)$/.test(ext)
              ? FileText
              : File;
  return (
    <span className={`file-symbol ${large ? 'large' : ''}`} aria-hidden="true">
      <Icon size={large ? 32 : 18} strokeWidth={1.5} />
    </span>
  );
}
