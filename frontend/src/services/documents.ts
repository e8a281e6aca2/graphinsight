import { api } from './api';

export interface DocumentItem {
  id: string;
  name: string;
  path: string;
  ext: string;
  size: number;
  updated_at: number;
}

export async function listDocuments() {
  const response = await api.get('/api/documents');
  return (response.data?.data?.items || []) as DocumentItem[];
}

export async function uploadDocuments(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const response = await api.post('/api/documents/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data?.data;
}
