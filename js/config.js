// Configuration publique. La clé anon est publique par conception : la sécurité
// repose sur les policies RLS de supabase/schema.sql. Ne jamais mettre la service_role ici.
export const SUPABASE_URL = 'https://enqgjsvqygqxeikfxwxe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_0EJZem-TiB4ltXxpQbeZRQ_JAaOjGb9';

export const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const AVATARS = ['01', '02', '03', '04', '05', '06'];
export const STOCKAGE = { son: 'balote.son', pseudo: 'balote.pseudo', avatar: 'balote.avatar', niveau: 'balote.niveau', boules: 'balote.boules', sol: 'balote.sol', but: 'balote.but', cailloux: 'balote.cailloux', longueur: 'balote.longueur', musique: 'balote.musique', piste: 'balote.piste' };
