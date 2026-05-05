-- Desabilita temporariamente o trigger de proteção para realizar a migração one-shot.
ALTER TABLE public.items DISABLE TRIGGER USER;

-- 1) Criar categoria "Sistema" (oculta) para cada organização que tenha o item Água
INSERT INTO public.categories (org_id, name, is_system)
SELECT DISTINCT i.org_id, 'Sistema', true
FROM public.items i
WHERE lower(i.name) IN ('água', 'agua', 'água (produção)', 'agua (producao)')
  AND NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.org_id = i.org_id AND c.name = 'Sistema'
  );

-- 2) Renomear "Água" para "Água (Produção)", garantir is_free=true, unit=KG,
--    custo zero, e vincular à categoria Sistema da própria organização.
UPDATE public.items i
SET
  name = 'Água (Produção)',
  unit = 'KG',
  is_free = true,
  is_system = true,
  cost_price = 0,
  category_id = (
    SELECT c.id FROM public.categories c
    WHERE c.org_id = i.org_id AND c.name = 'Sistema'
    LIMIT 1
  )
WHERE lower(i.name) IN ('água', 'agua');

-- Reabilita os triggers (proteção volta a vigorar).
ALTER TABLE public.items ENABLE TRIGGER USER;