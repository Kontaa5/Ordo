#INSY #4Klasse

Zwei Sitzungen ändern gleichzeitig dasselbe Konto:

> [!multi-column]
>
>> [!blank]
>> **S1**
>> ```sql
>> BEGIN;
>> SELECT saldo FROM konten
>> WHERE konto_id = 1;  -- liest 1050
>> UPDATE konten SET saldo = saldo + 100
>> WHERE konto_id = 1;
>> COMMIT;
>> ```
>
>> [!blank]
>> **S2**
>> ```sql
>> BEGIN;
>> SELECT saldo FROM konten
>> WHERE konto_id = 1;  -- blockiert
>> UPDATE konten SET saldo = saldo + 50
>> WHERE konto_id = 1;
>> COMMIT;
>> ```

Lösung: [[ACID]].
