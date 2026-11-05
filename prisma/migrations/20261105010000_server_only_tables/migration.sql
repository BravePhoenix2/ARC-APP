-- All app data is served by the Next.js API after its Privy/account checks.
-- No app table is a Supabase client API. Keep row security enabled with no
-- client policies, and remove inherited browser-role privileges explicitly.
-- The server database role must own these tables or have BYPASSRLS.
-- Only our model tables are affected; never revoke unrelated Supabase objects.
DO $server_only_tables$
DECLARE
  app_table text;
  browser_role text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'User',
    'AssetAuction',
    'TesterProfile',
    'TesterMilestone',
    'Item',
    'WatchlistEntry',
    'ArtOrder',
    'Listing',
    'Activity',
    'Submission',
    'CollectionImage',
    'WalletChallenge',
    'WalletSession',
    'UploadedImage',
    'EmailChallenge',
    'EmailSession',
    'PrivySession',
    'MintAccessPlan',
    'MintAllowlistEntry'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', app_table);
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', app_table, browser_role);
      END IF;
    END LOOP;
  END LOOP;
END
$server_only_tables$;
