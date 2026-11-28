-- private.brand_slug in pure ASCII (follow-up to 0013).
--
-- 0013 wrote the accent table as literal characters. Applied through a tool
-- that normalized the text to Unicode NFC, two of them (U+212A KELVIN SIGN,
-- U+212B ANGSTROM SIGN) arrived as their canonical equivalents (U+004B, U+00C5), so the
-- production function differed from the repository's on those two inputs.
-- This version spells the same 490 characters as U& escapes and the combining
-- range with chr() (U+0300-U+036F), so no transport can change it. Same behaviour as
-- 0013's file; every environment ends with this exact function text.
-- Idempotent.

create or replace function private.brand_slug(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '-' from regexp_replace(
    replace(
      lower(translate(regexp_replace(coalesce(p_name, ''), '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),
                      U&'\00C0\00C1\00C2\00C3\00C4\00C5\00C7\00C8\00C9\00CA\00CB\00CC\00CD\00CE\00CF\00D1\00D2\00D3\00D4\00D5'
                      || U&'\00D6\00D9\00DA\00DB\00DC\00DD\00E0\00E1\00E2\00E3\00E4\00E5\00E7\00E8\00E9\00EA\00EB\00EC\00ED\00EE'
                      || U&'\00EF\00F1\00F2\00F3\00F4\00F5\00F6\00F9\00FA\00FB\00FC\00FD\00FF\0100\0101\0102\0103\0104\0105\0106'
                      || U&'\0107\0108\0109\010A\010B\010C\010D\010E\010F\0112\0113\0114\0115\0116\0117\0118\0119\011A\011B\011C'
                      || U&'\011D\011E\011F\0120\0121\0122\0123\0124\0125\0128\0129\012A\012B\012C\012D\012E\012F\0130\0134\0135'
                      || U&'\0136\0137\0139\013A\013B\013C\013D\013E\0143\0144\0145\0146\0147\0148\014C\014D\014E\014F\0150\0151'
                      || U&'\0154\0155\0156\0157\0158\0159\015A\015B\015C\015D\015E\015F\0160\0161\0162\0163\0164\0165\0168\0169'
                      || U&'\016A\016B\016C\016D\016E\016F\0170\0171\0172\0173\0174\0175\0176\0177\0178\0179\017A\017B\017C\017D'
                      || U&'\017E\01A0\01A1\01AF\01B0\01CD\01CE\01CF\01D0\01D1\01D2\01D3\01D4\01D5\01D6\01D7\01D8\01D9\01DA\01DB'
                      || U&'\01DC\01DE\01DF\01E0\01E1\01E6\01E7\01E8\01E9\01EA\01EB\01EC\01ED\01F0\01F4\01F5\01F8\01F9\01FA\01FB'
                      || U&'\0200\0201\0202\0203\0204\0205\0206\0207\0208\0209\020A\020B\020C\020D\020E\020F\0210\0211\0212\0213'
                      || U&'\0214\0215\0216\0217\0218\0219\021A\021B\021E\021F\0226\0227\0228\0229\022A\022B\022C\022D\022E\022F'
                      || U&'\0230\0231\0232\0233\1E00\1E01\1E02\1E03\1E04\1E05\1E06\1E07\1E08\1E09\1E0A\1E0B\1E0C\1E0D\1E0E\1E0F'
                      || U&'\1E10\1E11\1E12\1E13\1E14\1E15\1E16\1E17\1E18\1E19\1E1A\1E1B\1E1C\1E1D\1E1E\1E1F\1E20\1E21\1E22\1E23'
                      || U&'\1E24\1E25\1E26\1E27\1E28\1E29\1E2A\1E2B\1E2C\1E2D\1E2E\1E2F\1E30\1E31\1E32\1E33\1E34\1E35\1E36\1E37'
                      || U&'\1E38\1E39\1E3A\1E3B\1E3C\1E3D\1E3E\1E3F\1E40\1E41\1E42\1E43\1E44\1E45\1E46\1E47\1E48\1E49\1E4A\1E4B'
                      || U&'\1E4C\1E4D\1E4E\1E4F\1E50\1E51\1E52\1E53\1E54\1E55\1E56\1E57\1E58\1E59\1E5A\1E5B\1E5C\1E5D\1E5E\1E5F'
                      || U&'\1E60\1E61\1E62\1E63\1E64\1E65\1E66\1E67\1E68\1E69\1E6A\1E6B\1E6C\1E6D\1E6E\1E6F\1E70\1E71\1E72\1E73'
                      || U&'\1E74\1E75\1E76\1E77\1E78\1E79\1E7A\1E7B\1E7C\1E7D\1E7E\1E7F\1E80\1E81\1E82\1E83\1E84\1E85\1E86\1E87'
                      || U&'\1E88\1E89\1E8A\1E8B\1E8C\1E8D\1E8E\1E8F\1E90\1E91\1E92\1E93\1E94\1E95\1E96\1E97\1E98\1E99\1EA0\1EA1'
                      || U&'\1EA2\1EA3\1EA4\1EA5\1EA6\1EA7\1EA8\1EA9\1EAA\1EAB\1EAC\1EAD\1EAE\1EAF\1EB0\1EB1\1EB2\1EB3\1EB4\1EB5'
                      || U&'\1EB6\1EB7\1EB8\1EB9\1EBA\1EBB\1EBC\1EBD\1EBE\1EBF\1EC0\1EC1\1EC2\1EC3\1EC4\1EC5\1EC6\1EC7\1EC8\1EC9'
                      || U&'\1ECA\1ECB\1ECC\1ECD\1ECE\1ECF\1ED0\1ED1\1ED2\1ED3\1ED4\1ED5\1ED6\1ED7\1ED8\1ED9\1EDA\1EDB\1EDC\1EDD'
                      || U&'\1EDE\1EDF\1EE0\1EE1\1EE2\1EE3\1EE4\1EE5\1EE6\1EE7\1EE8\1EE9\1EEA\1EEB\1EEC\1EED\1EEE\1EEF\1EF0\1EF1'
                      || U&'\1EF2\1EF3\1EF4\1EF5\1EF6\1EF7\1EF8\1EF9\212A\212B',
                      'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwyaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyyka')),
      '&', ' and '),
    '[^a-z0-9]+', '-', 'g'));
$$;

revoke all on function private.brand_slug(text) from public;
