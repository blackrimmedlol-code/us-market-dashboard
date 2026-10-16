import unittest
from unittest.mock import patch
from refresh_sectors import Members, core_members, attach_core_members

class CoreMembersTests(unittest.TestCase):
    def test_filters_members_and_duplicates(self):
        p = Members('Solar')
        p.feed('<option selected="selected" value="option">Optionable</option>'
               '<td data-boxover-industry="Solar" data-boxover-ticker="FSLR">'
               '<td data-boxover-industry="Solar" data-boxover-ticker="FSLR">'
               '<td data-boxover-industry="Other" data-boxover-ticker="BAD">')
        self.assertEqual(p.symbols, ['FSLR'])
        self.assertTrue(p.optionable)

    def test_cap_four(self):
        html = '<option selected value="option">'
        html += ''.join(f'<td data-boxover-industry="Solar" data-boxover-ticker="{s}">' for s in ['A','B','C','D','E'])
        with patch('refresh_sectors.fetch', return_value=html):
            self.assertEqual(core_members('Solar')['symbols'], ['A','B','C','D'])

    def test_failure_does_not_invent_members(self):
        with patch('refresh_sectors.fetch', side_effect=ValueError('offline')):
            p=attach_core_members({'gainers':[{'name':'Solar'}], 'losers':[]})
        self.assertEqual(p['coreTickers']['Solar']['status'], 'unavailable')
        self.assertEqual(p['coreTickers']['Solar']['symbols'], [])
