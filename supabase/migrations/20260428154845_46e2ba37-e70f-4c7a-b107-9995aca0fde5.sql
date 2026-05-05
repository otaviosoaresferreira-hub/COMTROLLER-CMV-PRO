DELETE FROM stock_levels WHERE location_id='74545d0f-1b74-4bca-894d-2dcf24082f89';
DELETE FROM movements WHERE from_location_id='74545d0f-1b74-4bca-894d-2dcf24082f89' OR to_location_id='74545d0f-1b74-4bca-894d-2dcf24082f89';
DELETE FROM locations WHERE id='74545d0f-1b74-4bca-894d-2dcf24082f89';