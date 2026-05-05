-- Reescreve handle_new_user para garantir isolamento estrito por organização.
-- Regra: todo novo usuário cria sua própria organização.
-- Exceção: se houver convite(s) pendente(s) para o e-mail dele, ingressa
-- nas organizações que o convidaram (com o papel definido no convite) e
-- marca o(s) convite(s) como aceitos. Não cria org nova nesse caso.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  invite_count integer := 0;
  new_org_id uuid;
  inv record;
BEGIN
  -- 1) Se houver convites pendentes para este e-mail, aceita todos.
  IF NEW.email IS NOT NULL THEN
    FOR inv IN
      SELECT id, org_id, role
      FROM public.organization_invites
      WHERE lower(email) = lower(NEW.email)
        AND accepted_at IS NULL
    LOOP
      -- Adiciona como membro da organização que o convidou
      INSERT INTO public.organization_members(org_id, user_id, role)
      VALUES (inv.org_id, NEW.id, inv.role)
      ON CONFLICT DO NOTHING;

      -- Marca o convite como aceito
      UPDATE public.organization_invites
      SET accepted_at = now()
      WHERE id = inv.id;

      invite_count := invite_count + 1;
    END LOOP;
  END IF;

  -- 2) Se NÃO havia convites, cria sempre uma nova organização própria
  --    (não usa mais a organização inicial 00000000-...-001 como fallback).
  IF invite_count = 0 THEN
    INSERT INTO public.organizations(name)
    VALUES (COALESCE(NEW.raw_user_meta_data->>'restaurant_name', 'Meu Restaurante'))
    RETURNING id INTO new_org_id;

    INSERT INTO public.organization_members(org_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');
  END IF;

  RETURN NEW;
END
$function$;

-- Garante que o trigger esteja ativo em auth.users (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;