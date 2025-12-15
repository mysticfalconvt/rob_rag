declare module 'pdf-poppler' {
  export interface ConvertOptions {
    format?: 'jpeg' | 'png' | 'tiff' | 'ps' | 'eps' | 'svg';
    out_dir?: string;
    out_prefix?: string;
    page?: number | null;
    scale?: number;
    antialias?: boolean;
    gray?: boolean;
    mono?: boolean;
    fill?: boolean;
    print?: boolean;
  }

  export function convert(
    file: string,
    opts?: ConvertOptions
  ): Promise<void>;

  export function info(file: string): Promise<any>;
}
