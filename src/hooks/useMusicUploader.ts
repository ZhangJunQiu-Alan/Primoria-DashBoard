import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useCloudSync } from '@/components/cloud/cloudSyncContext'
import {
  isSupportedAudioFile,
  MAX_TRACK_BYTES,
  parseTrackMetadata,
  STORAGE_QUOTA_BYTES,
} from '@/lib/musicLibrary'
import { useMusicStore } from '@/store/musicStore'

interface UseMusicUploaderResult {
  uploading: boolean
  busy: { done: number; total: number } | null
  handleFiles: (files: FileList | null) => Promise<void>
}

export function useMusicUploader(): UseMusicUploaderResult {
  const { user } = useCloudSync()
  const upload = useMusicStore((s) => s.upload)
  const usageBytes = useMusicStore((s) => s.usageBytes)

  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!user) {
        toast.error('请先登录后再上传音乐')
        return
      }
      if (!files || files.length === 0) return

      const valid: File[] = []
      let pendingBytes = 0
      for (const file of Array.from(files)) {
        if (!isSupportedAudioFile(file)) {
          toast.error(`${file.name}：不是受支持的音频格式`)
          continue
        }
        if (file.size > MAX_TRACK_BYTES) {
          toast.error(`${file.name}：超过 30MB 单文件上限`)
          continue
        }
        pendingBytes += file.size
        valid.push(file)
      }

      if (valid.length === 0) return
      if (usageBytes + pendingBytes > STORAGE_QUOTA_BYTES) {
        toast.error('存储不足，请先删除部分歌曲')
        return
      }

      setUploading(true)
      setBusy({ done: 0, total: valid.length })

      let succeeded = 0
      try {
        for (let i = 0; i < valid.length; i++) {
          const file = valid[i]
          try {
            const metadata = await parseTrackMetadata(file)
            await upload(user.id, file, metadata)
            succeeded += 1
          } catch (err) {
            const msg = err instanceof Error ? err.message : '上传失败'
            toast.error(`${file.name}：${msg}`)
          }
          setBusy({ done: i + 1, total: valid.length })
        }
        if (succeeded > 0) toast.success(`已上传 ${succeeded} 首`)
      } finally {
        setUploading(false)
        setBusy(null)
      }
    },
    [user, upload, usageBytes]
  )

  return { uploading, busy, handleFiles }
}
