using System;
namespace PurrlorPlus;
internal static class BoundsChecks
{
    static int Main()
    {
        var checks = new[] {
            ("Taskleiste unten", 0,0,0,0,1920,1040, (0,0,1920,1040)),
            ("Taskleiste oben", 0,0,0,40,1920,1080, (0,40,1920,1040)),
            ("Taskleiste links", 0,0,60,0,1920,1080, (60,0,1860,1080)),
            ("Taskleiste rechts", 0,0,0,0,1860,1080, (0,0,1860,1080)),
            ("Monitor links", -1920,0,-1920,0,0,1040, (0,0,1920,1040)),
            ("Monitor oben", 0,-1080,0,-1080,1920,-40, (0,0,1920,1040)),
            ("Zweiter Monitor mit linker Taskleiste", 1920,0,1980,0,4480,1440, (60,0,2500,1440)),
        };
        foreach(var test in checks)
        {
            var actual = WindowWorkArea.Calculate(test.Item2,test.Item3,test.Item4,test.Item5,test.Item6,test.Item7);
            if(actual != test.Item8) throw new Exception(test.Item1 + ": unerwartete Maximierungsgrenzen " + actual);
            Console.WriteLine("Bestanden: " + test.Item1);
        }
        return 0;
    }
}
