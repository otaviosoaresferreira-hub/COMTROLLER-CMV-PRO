
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','hidden_system_categories','item_batches','item_categories','items','locations','movements','stock_levels'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=('public.'||t)::regclass AND contype='p') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (id)', t, t||'_pkey');
    END IF;
  END LOOP;
END $$;
