using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.AspNetCore.Http;

namespace Endgame.AppKit;

/// <summary>
/// Checks the DataAnnotations on every request body an <c>api/</c> endpoint takes — <c>[Required]</c>,
/// <c>[StringLength]</c>, <c>[Range]</c>, <see cref="IValidatableObject"/> — before the handler runs,
/// and answers a 400 validation problem with one entry per field. Handlers only ever see valid input.
/// </summary>
internal static class InputValidation
{
    internal static EndpointFilterDelegate Factory(EndpointFilterFactoryContext context, EndpointFilterDelegate next)
    {
        var validated = context.MethodInfo.GetParameters()
            .Select((p, i) => (Index: i, p.ParameterType))
            .Where(p => NeedsValidation(p.ParameterType))
            .Select(p => p.Index)
            .ToArray();
        if (validated.Length == 0)
        {
            return next;
        }

        return async invocation =>
        {
            var errors = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var index in validated)
            {
                var value = invocation.Arguments[index];
                if (value is null)
                {
                    continue;
                }

                var results = new List<ValidationResult>();
                Validator.TryValidateObject(value, new ValidationContext(value, invocation.HttpContext.RequestServices, null), results, validateAllProperties: true);
                foreach (var result in results)
                {
                    foreach (var member in result.MemberNames.DefaultIfEmpty(""))
                    {
                        (errors.TryGetValue(member, out var list) ? list : errors[member] = []).Add(result.ErrorMessage ?? "Invalid.");
                    }
                }
            }

            return errors.Count == 0
                ? await next(invocation)
                : TypedResults.ValidationProblem(errors.ToDictionary(e => e.Key, e => e.Value.ToArray()), title: "Some fields need fixing");
        };
    }

    private static bool NeedsValidation(Type type) =>
        type.IsClass && type != typeof(string) && !typeof(Delegate).IsAssignableFrom(type)
        && (typeof(IValidatableObject).IsAssignableFrom(type)
            || type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Any(p => p.IsDefined(typeof(ValidationAttribute), true)));
}
