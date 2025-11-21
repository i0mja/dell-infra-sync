-- Create virtual_media_settings table for storing default virtual media share configuration
CREATE TABLE IF NOT EXISTS public.virtual_media_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  share_type TEXT NOT NULL DEFAULT 'nfs',
  host TEXT NOT NULL,
  export_path TEXT,
  iso_path TEXT,
  use_auth BOOLEAN NOT NULL DEFAULT false,
  username TEXT,
  password TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.virtual_media_settings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can manage virtual media settings"
  ON public.virtual_media_settings
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view virtual media settings"
  ON public.virtual_media_settings
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_virtual_media_settings_updated_at
  BEFORE UPDATE ON public.virtual_media_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();